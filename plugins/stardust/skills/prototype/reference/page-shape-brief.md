# Page-shape brief

The format spec for `stardust/prototypes/<slug>-shape.md` — a
**per-page compositional brief** authored at the start of
`prototype` Phase 1 and consumed by craft during render.

The brief exists because `direct` authors site-level concerns only
(tokens, voice rules, abstract component vocabulary, named system-
component roles). Page-level decisions — *which* sections appear on
*this* page, in what order, with what literal content, at what
section-level dimensions, in what composition — live here, with
the per-page artifact, not in the site spec
(`STARDUST-FEEDBACK.md F-015`).

The split avoids three problems that v0.1's mash-up created:

1. DESIGN.md grew per-page as more pages were prototyped, baking
   each page's specifics into the site spec.
2. Direct over-specified the visual layer at site-time, leaving
   prototype no room to diverge per-page.
3. Re-direct semantics were ambiguous — was the user changing the
   SYSTEM (tokens, voice) or the per-page DEPLOYMENT (composition
   on this page)? The mash-up made the question unanswerable from
   the file.

`page-shape-brief.md` is the page-level deployment record;
`DESIGN.md` is the site-level system. A direction change
invalidates the system; the deployment is content-aware-stale only
when the system change makes the brief's composition impossible
(rare). See `skills/stardust/reference/state-machine.md` § Stale
flagging for the recalibrated semantics.

---

## Output path

```
stardust/prototypes/<slug>-shape.md
```

Written by `$stardust prototype` Phase 1 before craft is invoked.
Re-iterations re-author the brief only when the user's iteration
phrase moves the *composition* (e.g. "split the hero into two
columns") rather than the *style* (e.g. "make it bolder"). Style
iterations live in `<slug>-proposed.html` directly via
`$impeccable live` or chat-driven impeccable invocations.

---

## File shape

```markdown
<!-- stardust:provenance
  writtenBy:        stardust:prototype/shape
  writtenAt:        2026-04-27T18:00:00Z
  page:             home
  pageUrl:          https://example.com/
  againstDirection: stardust/direction.md (Active 2026-04-27T15:42:00Z)
  consumedBy:       impeccable:craft
  readArtifacts:
    - stardust/current/pages/home.json
    - DESIGN.md
    - DESIGN.json
    - stardust/direction.md
  stardustVersion:  0.2.0
-->
---
slug: home
url: https://example.com/
register: brand
---

# Page shape: home

## Sections (in render order)

1. **header** (system-component role: `header`) — site-wide nav.
   Composition for this page: full-width, dark surface, primary
   logo on the left, 5 nav links on the right, donate CTA in
   accent.
2. **hero** — split layout, 5/3 ratio. Headline left
   (`voice.heroHeadline` from current/pages/home.json), memoir
   card right (testimonial sourced from
   `_brand-extraction.json#voice.firstParagraph`). Photographic
   ground using `assets/media/hero-a3f9.jpg`. CTAs: primary
   "Donate" (existing), secondary "Find Help" (existing).
3. **stat row** — 4-tile horizontal row. Tiles: `100 YEARS · …`,
   `… PEOPLE HOUSED · …`, `… GRANTED · …`, `… CENTERS · …`. **All
   four numerals are placeholders** — current/pages/home.json
   provides no statistics. Render with the placeholder visual
   signature per `before-after-shell.md` § Content sourcing
   hierarchy.
4. **threshold band** (system-component role: `cta-band`) — site-
   wide block, see `_brand-extraction.json#crossPromo`. Render the
   captured tiles verbatim; do not re-author copy.
5. **stories** — three story cards in a 3-up grid. Card content
   from current/pages/home.json testimonials section (Ray, Randall,
   Cole). Images from `assets/media/`.
6. **footer** (system-component role: `footer`) — site-wide. Render
   per `_brand-extraction.json#systemComponents[kind=footer]`.

## Layout strategy

- Density: airy (8pt base scale per DESIGN.md `spacing`).
- Columns: 12-col CSS grid with 32px gutter at desktop; collapses
  to single column at <768px.
- The 5/3 hero split inverts to stacked at <1024px (memoir card
  becomes the second block, full-width).

## Key states

- Default — described above.
- Empty (no stories) — replace stories grid with a one-line
  call-to-action "Share your story →". Not invoked in this run
  but specified for migrate's render-from-scratch path.
- Loading / Error — N/A for static page.

## Interaction model

- Header donate CTA → `/donate` (existing).
- Hero secondary CTA → `/get-help` (existing).
- Stat tiles — non-interactive; informational.
- Threshold band tiles — each links to its captured target.
- Story cards — click expands inline (no modal), CSS-only
  `<details>`.

## Data attributes

- `header[data-section="header"][data-intent="navigate"][data-layout="full-width-dark"]`
- `section[data-section="hero"][data-intent="primary-action"][data-layout="split-5-3"][data-items="2"]`
- `section[data-section="stat-row"][data-intent="impact"][data-layout="grid-4"][data-items="4"]`
- `section[data-section="threshold-band"][data-intent="cross-promo"][data-layout="full-width-tiles"][data-items="6"]`
- `section[data-section="stories"][data-intent="testimony"][data-layout="grid-3"][data-items="3"]`
- `footer[data-section="footer"][data-intent="navigate"][data-layout="mega"]`

## Unsourced content (placeholder list)

Bridge to `<slug>-proposed.html`'s `_provenance.unsourcedContent[]` —
listed here at brief-time so craft knows which sections to render
with the placeholder signature, not invented.

- `section[data-section="stat-row"] .stat:nth-child(1) .number`
  — `100 YEARS` literal value: source unknown; placeholder.
- `section[data-section="stat-row"] .stat:nth-child(2) .number`
  — `PEOPLE HOUSED` count: source unknown; placeholder.
- `section[data-section="stat-row"] .stat:nth-child(3) .number`
  — `GRANTED` dollar figure: source unknown; placeholder.
- `section[data-section="stat-row"] .stat:nth-child(4) .number`
  — `RESOURCE CENTERS` count: source unknown; placeholder.

Cross-references the F-002 content sourcing rules. Every
placeholder noted here MUST appear in
`<slug>-proposed.html`'s `unsourcedContent[]` after render.

## Open questions for craft

- Should the memoir card render with the brand display font or the
  body font? (DESIGN.md doesn't specify per-section; resolving here
  per page.)
- Should the story-card `<details>` use a chevron toggle or a
  full-card click target? (Interaction style for this page.)

These are page-level decisions craft makes during render. Logged
here so the brief reviewer can challenge them before render rather
than discover them in the proposed HTML.
```

---

## Required vs optional sections

**Required** in every brief:

- Frontmatter (`slug`, `url`, `register`).
- `## Sections (in render order)` — the section list with role
  and composition note per section.
- `## Data attributes` — the contract for `<slug>-proposed.html`'s
  structural attributes.
- `## Unsourced content` — bridge to F-002 placeholder list, even
  if empty (emit `(none)`).

**Optional** but recommended:

- `## Layout strategy` — when the page deploys an unusual layout
  rule that's not the system default.
- `## Key states` — when the page has non-default empty / loading /
  error states the migrate path-B render needs to know about.
- `## Interaction model` — when the page has non-trivial JS-free
  interactions (CSS `<details>`, `:target` panels, etc.).
- `## Open questions for craft` — page-level decisions deferred
  during brief authoring.

Sections may be omitted when their content is "inherits site
default."

---

## Authoring procedure

`$stardust prototype` Phase 1 step 4 (revised):

1. Read `current/pages/<slug>.json` for the captured page.
2. Read `_brand-extraction.json` for system components and
   cross-promo data.
3. Read `DESIGN.md` and `DESIGN.json` for the site system.
4. Read `direction.md` for the resolved direction.
5. Author `<slug>-shape.md` directly — the agent composes the
   brief from these inputs following the format above. No
   interview, no impeccable invocation. The brief is the result
   of stardust's reasoning about how the system deploys to *this*
   page given *this* content.
6. Show the brief to the user and ask for confirmation before
   moving to Phase 2 (craft render). The brief is editable: the
   user can rearrange sections, kill an `Open question`, change
   composition decisions. Re-rendering rebuilds the proposed
   file from the (possibly edited) brief.

The agent does NOT use `$impeccable shape` for brief authoring in
v0.2 — direct authoring matches the pattern stardust already uses
for PRODUCT.md / DESIGN.md / DESIGN.json / direction.md, and
running impeccable:shape per-page would re-introduce an interview
at every page (`STARDUST-FEEDBACK.md F-016`). When per-page hand
authoring proves insufficient (the agent skips Layout Strategy or
Key States consistently across multiple sites), revisit F-016 and
consider routing brief authoring through impeccable:shape.

---

## Why markdown rather than JSON

Same reason as `direction.md`: the brief is reasoning a human
reviewer wants to read in order, not a machine-consumed contract.
Composition decisions ("hero is split 5/3") are easier to read and
edit as prose than as a tree of objects. Craft consumes the brief
as a prompt input, not as a structured payload.

Where the brief carries machine-consumed structure (data
attributes, unsourced content list), it uses code blocks and
tables that parse cleanly. The provenance comment is YAML in a
standard `<!-- stardust:provenance -->` block per the artifact-map.
