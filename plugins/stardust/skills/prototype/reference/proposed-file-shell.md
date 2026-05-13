# Proposed-file shell

Stardust's prototype output is a **single file per page**, written at
`stardust/prototypes/<slug>-proposed.html`. It's the self-contained
redesign of the page — what the user opens in the browser to review,
what chat-driven impeccable commands iterate on, what `$stardust
migrate` later re-derives from `DESIGN.md`.

There is no per-page before/after viewer. The proposed file is the
artifact; comparing to the current page happens by switching browser
tabs (the captured screenshot at
`stardust/current/assets/screenshots/<slug>.png` or the live URL from
`state.json`).

---

## Required structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- stardust:provenance ... -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><!-- page title from current/pages/<slug>.json --></title>
  <style>
    /* The :root token contract — see skills/stardust/reference/token-contract.md */
    :root { ... }
    /* component-level styles, derived from DESIGN.json components */
    /* ... */
  </style>
</head>
<body>
  <header data-section="..." data-intent="..." data-layout="..."> ... </header>
  <main>
    <section data-section="hero" data-intent="..." data-layout="..."> ... </section>
    <section data-section="..." ...> ... </section>
  </main>
  <footer data-section="footer" data-intent="..." data-layout="..."> ... </footer>
</body>
</html>
```

## Hard requirements

The proposed file must satisfy:

1. **Self-contained.** No external CSS, no external JS. Fonts: prefer
   system stack; if a custom face is needed (the chosen font deck
   includes it), inline the `@font-face` with a Google Fonts CSS
   `@import` is acceptable for prototyping but not for migrate
   output.

   **Inline `<script>` exception — mobile nav a11y.** When Phase 2.7
   applies the stock hamburger pattern (per
   `mobile-nav-collapse.md`), the file carries a ≤10-line inline
   `<script>` that syncs `aria-expanded` on the burger button and
   wires Escape-to-close. This is the one place stardust's "no JS"
   preference bends, and only for assistive-tech support. The
   rationale lives in `mobile-nav-collapse.md` § Accessibility
   checklist. No other inline scripts are permitted. The fixture
   at `skills/prototype/fixtures/mobile-nav-collapse-example.html`
   shows the exact script.
2. **`:root` token block** as the first content of the first
   `<style>`. See `skills/stardust/reference/token-contract.md`.
3. **Structural data attributes** on every section. See
   `skills/stardust/reference/data-attributes.md`.
4. **Provenance comment** as the first child of `<head>`.
5. **Divergence audit clean.** Every anti-toolbox hit (per
   `skills/stardust/reference/divergence-toolkit.md` § 1) appears in
   `DESIGN.json.extensions.divergence.anti_toolbox_hits` with a
   brand-specific justification.
6. **Impeccable hard rules respected, with format and brand-faithful
   reconciliation.** OKLCH colors, no glassmorphism reflex, no
   gradient text, no side stripes > 1px, no skipped headings, type
   ratio ≥ 1.25 for brand register. Two refinements
:

   - **Color format follows DESIGN.md frontmatter.** The proposed
     file's `:root` token block uses the **same color format as
     `DESIGN.md`'s `colors:` frontmatter**. If DESIGN.md ships hex
     (Stitch validates hex sRGB; OKLCH triggers a Stitch lint
     warning), `:root` is hex. If DESIGN.md ships OKLCH, `:root` is
     OKLCH. The "OKLCH only" rule from impeccable applies at
     **DESIGN.md authoring time** (during `direct`), not at
     prototype render time — at render time the prototype must
     match the format the source-of-truth file declares, or the
     prototype's tokens diverge from DESIGN.md and migrate has to
     re-translate.

   - **Brand-faithful pure-white / pure-black inheritance.** The
     "no pure `#000`/`#fff`" rule applies to **agent-default token
     authoring** (preventing the assistant from reaching for
     `#000` text on `#fff` background as a reflex). When the
     existing brand uses pure white as the page ground (or pure
     black as text) and `direction.md` resolves a brand-faithful
     stance — the existing palette is preserved because the
     redesign does not move color-energy or color away from the
     brand — pure white / pure black are **allowed** and the rule
     is inverted: the redesign target preserves them as a brand
     decision, not an agent reflex. Document the inversion in
     `DESIGN.json.extensions.divergence.notes` so downstream
     consumers know the pure-color was chosen, not defaulted into.
7. **Content preserved from the current page.** Hero copy, CTAs,
   navigation labels, body copy come from `current/pages/<slug>.json`.
   The redesign changes how content is presented, not what content is
   present, unless `direction.md` explicitly authorises content
   changes. See § Content sourcing hierarchy below for the exact
   contract — including how to handle content the new design
   *demands* but the page *does not provide* (stat rows, addresses,
   testimonial quotes, etc.).

## Content sourcing hierarchy

Every literal value rendered into `<slug>-proposed.html` — every
heading, paragraph, CTA label, statistic, address, quote, name,
phone number, hours, tax ID, link target — must come from one of
the **allowed sources** below, or be rendered with the **mandatory
PLACEHOLDER signature**.

This section exists because the v0.2 prototype produced fabricated
content: an invented stat row, an
invented street address, an invented tax ID, and a memoir quote
attributed to a real person who never said it. For a real nonprofit
or any production site this is a serious harm — invented content
looks authoritative once rendered.

### Allowed sources, in priority order

1. **`stardust/current/pages/<slug>.json`** — the captured page.
   Use values verbatim. Headings, body copy, CTA labels, navigation
   labels, link targets, alt text, form fields all live here.
2. **`stardust/current/_brand-extraction.json`'s voice samples** —
   `voice.heroHeadline`, `voice.firstParagraph`, `voice.ctaSamples`,
   `voice.navItems`, `voice.footerHeadings`. Used when a page's own
   JSON lacks a value the design demands and the brand-surface
   sample is the closest authentic source.
3. **`stardust/direction.md` § Pages in scope content**, if direction
   explicitly authorises new content (e.g. a renamed CTA, a
   shortened tagline). Direction must spell out the change verbatim
   — not just "rewrite the hero in playful tone."
4. **None of the above.** Render with the PLACEHOLDER signature
   (next subsection). Do not invent.

The agent **must not invent** any of the following without
explicit user-confirmed direction-document authorisation:

- Numerical statistics (people served, dollars raised, years in
  operation, percentages, counts).
- Postal addresses, suite numbers, floor numbers.
- Phone numbers, email addresses.
- Tax IDs, registration numbers, license numbers, EINs.
- Quotes, testimonials, named persons' words.
- Hours of operation, holiday schedules, event dates.
- Awards, certifications, partnership names.
- Pricing, plan names, feature lists not in the captured page.

These categories are the most consequential to invent and the most
likely to be demanded by a redesign template (stat rows,
testimonial cards, contact panels, pricing tables) without the
captured page providing them.

### PLACEHOLDER visual signature (mandatory)

When the new design demands content the captured page does not
provide, render it as a placeholder element with **all** of:

- A `2px dashed var(--accent)` outline.
- A monospace eyebrow text reading
  `PLACEHOLDER · <type>` where `<type>` is one of:
  `stat | address | quote | tax-id | phone | email | hours | award | price | other`.
- A distinct background tint (e.g. `var(--surface-alt)` with
  `opacity: 0.7`).
- A short example or shape hint inside (e.g. `e.g. 18,400 people
  housed`) to communicate the slot's intent — but clearly marked
  as illustrative, not factual.
- HTML annotation:

  ```html
  <span data-placeholder="true"
        data-placeholder-type="stat"
        data-placeholder-source="design demanded by T-stat-row-pattern; not in current/pages/home.json">
    <span class="placeholder-eyebrow">PLACEHOLDER · stat</span>
    <span class="placeholder-shape">e.g. 18,400 people housed</span>
  </span>
  ```

The visual signature is not optional and must remain visible in
screenshots. The reviewer must be unable to mistake a placeholder
for real content.

### Provenance log of unsourced content

Add an `unsourcedContent[]` array to the proposed file's provenance
listing every placeholder element rendered, with the reason:

```yaml
unsourcedContent:
  - selector: "section[data-section=\"stats\"] .stat:nth-child(1)"
    type: stat
    reason: "design demanded stat row; current/pages/home.json provides no statistics"
  - selector: "footer address"
    type: address
    reason: "design demanded contact address; current/pages/home.json has only nav links"
  - selector: ".testimonial blockquote"
    type: quote
    reason: "design demanded testimonial card; voice samples include names but no quoted text"
```

This list is the canonical record of what needs to be sourced
before the prototype becomes a production deliverable.

### Migrate guard

`migrate` reads the proposed file's `unsourcedContent[]` and the
DOM's `[data-placeholder]` elements. If any are present, migrate
**refuses to ship** — there is no bypass flag. Migrate prints the
unsourced list and exits with a non-zero status. The user fills
the missing content in the proposed file (re-prototype or edit
inline) and re-invokes migrate. Spec for the migrate guard lives
in `skills/migrate/SKILL.md` § Failure modes.

## Provenance

```html
<!-- stardust:provenance
  writtenBy:         stardust:prototype  (or stardust:prototype/iterate after refinement)
  writtenAt:         2026-04-25T16:42:00Z
  page:              home
  pageUrl:           https://example.com/
  iteratedVia:       impeccable:bolder, impeccable:typeset   # commands run since initial render
  againstDirection:  stardust/direction.md (Active 2026-04-25T15:42:00Z)
  readArtifacts:
    - stardust/current/pages/home.json
    - DESIGN.md
    - DESIGN.json
  divergenceVersion: v1.0 (stardust v2)
  fontDeck:          zine-maximalist
  paletteSource:     library:Brutalist Dawn (recommended_index=2, picked_index=2)
  unsourcedContent: []   # populated when design demands content the page doesn't provide; see § Content sourcing hierarchy
  stardustVersion:   0.2.0
-->
```

`iteratedVia` appends each impeccable command run against the file
after the initial render; absent on the initial render.
`unsourcedContent[]` lists placeholder elements per § Content
sourcing hierarchy.

---

## Stale handling

When `direction.md` changes, the prototype's provenance comment
lists an `againstDirection` that is no longer the active direction.
`state.json` flags the page `stale: true`. Re-runs of
`$stardust prototype <slug>` skip the page by default; pass
`--all` to re-prototype every stale page.

The user can still open and review a stale prototype — it is a
valid artifact representing the prior direction. They opt into
refreshing when ready.
