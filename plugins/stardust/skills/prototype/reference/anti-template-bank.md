# Anti-template move bank

Curated bank of non-template moves Discipline 3 draws from when a
per-page `surprise` tier is `medium` or `high`. Each move is a
substitution for a captured cliché pattern; pages declare the
move they're applying in `<slug>-shape.md#surpriseMoves[]` with a
captured-source citation.

The bank is **closed**. New moves require an entry here with a
worked example and a captured-trait amplification rationale.

See `stardust/reference/divergence-toolkit.md` § Non-template
move bank for the move list summary; this file is the
implementation reference with worked examples.

---

## 1. Typographic substitution

Replace a tile / card grid with a text-only document register —
ledger row, running list, typed index, or marquee parade.

### When it fits

- Captured pattern: 3-up / 4-up / 5-up image-card grid where the
  image is decorative rather than load-bearing.
- Captured trait amplified: the brand's **vernacular naming** (a
  product line whose names carry the poetry) or **catalog density**
  (more items than fit comfortably in cards).

### Cliché replaced

5-up image-card grid as category nav (the universal AI silhouette
for catalog landings).

### Worked example — beers-B (wasatch dry-run)

Variant B of `/beers` amplified the **vernacular-naming** captured
trait. Where variant A renders 6 image-card entries in a 3-column
grid, variant B renders them as a **typographic parade**: each
beer name at `clamp(5rem, 12vw, 8rem)` running down the column,
metadata in a side rail, photo as a 180px framed thumbnail rather
than the column's lead.

Brief excerpt:

```yaml
surpriseMoves:
  - move: typographic-substitution
    cliche: "5-up image-card grid"
    capturedSource: "Lambrate's product names are the poetry of the brand
      (Ghisa, Montestella, Sant'Ambrogio, Domm); rendered as a parade rather
      than a grid lets the names carry the visual weight"
    rationale: "The captured site renders names at body scale inside small
      cards; the parade restores the names to the brand's actual poetry-scale"
```

### Refusal patterns

- Substituted text-only register WITHOUT amplifying a naming /
  catalog-density trait fails Discipline 2 (anti-template pass):
  the move is template-shaped in the other direction (text-only
  list is a recognisable archetype too).

---

## 2. Substrate-promotion

Promote a brand color from accent (≤ 10% of surface area) to page
ground (≥ 50%). The accent becomes the substrate; the prior ground
becomes the accent.

### When it fits

- Captured pattern: white / pale-neutral ground with a saturated
  accent that recurs across the site as the brand's signature
  color.
- Captured trait amplified: **brand-color-as-environment** — when
  the accent IS the brand identity, making it the substrate makes
  the page *feel* like the brand rather than *displaying* the
  brand.

### Cliché replaced

Stark-white / cream / pale-gray ground with brand color rationed
to CTA fills and accent borders.

### Worked example — wasatch home C2

Promotes brand black from text color to page ground. The page is
ink-dark by default; cream text and yellow eyebrow tile float as
elements on the black substrate. Hero photo full-bleed within a
black frame; section transitions are color-keyed rather than
white-rules.

```yaml
surpriseMoves:
  - move: substrate-promotion
    cliche: "white ground + brand black for text only"
    capturedSource: "wasatch's beer-bottle photography is shot on dark
      backgrounds; the brand's visual register is night-mode-leaning
      even though the captured site renders on white"
    rationale: "promoting black to substrate aligns the digital surface
      with the photographic register of the captured can artwork"
```

### Refusal patterns

- Promoting a color the captured site uses sparingly (alarm-red
  for error states, banner-yellow for promo eyebrow) as the page
  ground is a misuse — the role-rarity is itself a brand decision.
  Refuse and look for a different captured trait to amplify.

---

## 3. Inversion

Negative-space dominant where original was content-dominant. The
hero is mostly empty; the headline anchors a composition framed by
ground rather than supporting copy.

### When it fits

- Captured pattern: dense hero with headline + subhead + CTA pair
  + hero image + trust bar all above the fold.
- Captured trait amplified: **editorial confidence** — the brand
  is sure enough of its position that it doesn't need a thicket of
  supporting elements.

### Cliché replaced

Centered-stack hero with two-button CTA pair (the Generic-2026-SaaS
silhouette per `divergence-toolkit.md` § 1).

### Worked example

A pricing page that swaps a 3-tier comparison table for a single
question (*"What's it worth to you?"*) on an otherwise-empty
viewport, with tier details below the fold. The captured
comparison table was 70% of above-the-fold content; the inversion
makes it 0%.

```yaml
surpriseMoves:
  - move: inversion
    cliche: "dense hero with comparison table above fold"
    capturedSource: "the brand's voice samples consistently lead with a
      provocative question rather than a feature list — the inversion
      restores that voice to the hero"
    rationale: "matches captured voice register"
```

### Refusal patterns

- Inversion on a high-traffic conversion page (donate, buy, signup)
  conflicts with IA-priority preservation (§ 8 of `intent-
  dimensions.md`). The IA priority must stay above the fold —
  inversion is fine for editorial / about / story pages but not
  for conversion paths.

---

## 4. Document-shape

Replace a card grid with a table / ledger / index card / poster /
docket / zine spread. The page adopts the document's structural
rhythm (per-block substrate, per-spread layout, per-row
typography).

### When it fits

- Captured pattern: card / grid surface for a content set whose
  shape is genuinely tabular, sequential, or document-like.
- Captured trait amplified: **content-as-document** — the
  catalog IS a catalog, the schedule IS a timetable, the team
  page IS a list of cards from a card-catalog.

### Substrate-keyed sub-kinds (friction #2)

Document-shapes that are substrate-keyed carry a per-section
substrate citation. The ≤ 2-substrate-transition cap (Discipline
4) does not apply when each transition carries a per-section
captured-source citation:

- **zine** — per-spread substrate keyed to per-SKU label color
  or per-section theme color
- **catalog-card** — per-card substrate keyed to per-product
  category or per-SKU dominant color
- **poster-sequence** — per-poster substrate keyed to per-event
  theme or per-month seasonal palette

### Worked example — beers-C (wasatch dry-run, approved)

Variant C of `/beers` amplified the **label-color-as-design**
captured trait. Where variant A renders 6 entries on a uniform
black ground, variant C renders 6 per-SKU color-block
**zine spreads**, each substrate cited to the dominant color of
the generated can artwork:

| Entry | Substrate | Source |
|---|---|---|
| Tabernacle | `#5a1a1a` oxblood | `assets/media/beer-tabernacle-4x5.jpg` label dominant |
| Cutthroat | `#177566` darker-teal | beer-cutthroat-4x5.jpg label (`#1c8a7a` adjusted +1 stop for AA contrast) |
| Goldspike | `#e8b830` golden | beer-goldspike-4x5.jpg label dominant |
| Antelope | `#a7c8e3` sky-blue | beer-antelope-4x5.jpg label dominant |
| Powder Day | `#3eb0d8` cyan | beer-powder-day-4x5.jpg label dominant |
| Hoarfrost | `#1f2c5c` deep-indigo | beer-hoarfrost-4x5.jpg label dominant |

Brief excerpt:

```yaml
surprise: high
dominantDimension: ground-family/label-substrate-zine
surpriseMoves:
  - move: document-shape
    subkind: zine
    cliche: "uniform-substrate vertical list"
    capturedSource: "Lambrate cans are always shot on wallpaper-colored-to-match
      per-SKU label color — the per-SKU substrate IS the brand's product-
      photography convention rendered to digital"
    rationale: "substrate-per-section IS the captured trait, not a slider-pushed
      extreme; each substrate carries a per-SKU label-color citation"
```

This is the worked example of friction carve-out #2 — six
substrate transitions exceed Discipline 4's ≤ 2 cap, justified by
the substrate-keyed document-shape exception with per-section
captured-source citations.

### Refusal patterns

- Document-shape WITHOUT a captured-source citation per section
  (when substrate-keyed) re-engages the ≤ 2 cap. Decorative
  per-section substrates without citation fail Discipline 4.
- Document-shape applied to content that is NOT actually document-
  shaped fails Discipline 2 (anti-template pass): a 3-item
  testimonial section dressed up as a "docket" reads as cosplay.

---

## 5. Scale-displacement

One element rendered at 4–8× normal size; others at 0.5×. The
display headline becomes the page's primary structural element,
with body text receding to caption scale.

### When it fits

- Captured pattern: balanced section hierarchy where every section
  is roughly the same visual weight.
- Captured trait amplified: **single-statement confidence** —
  one beat carries the page, supported by caption-density
  surrounding material.

### Cliché replaced

Hero-then-bands silhouette where every band has equal headline
weight.

### Worked example

A wordmark-as-page treatment: the brand name at `clamp(8rem, 24vw,
20rem)` consumes 70% of the viewport, with body sections rendered
at caption scale (`var(--t-11)`–`var(--t-13)`) running below as a
single dense column.

```yaml
surpriseMoves:
  - move: scale-displacement
    cliche: "balanced-band hero"
    capturedSource: "the brand mark is unusually expressive and the captured
      site under-renders it (logo at 180px next to a generic hero photo);
      promoting the wordmark to page scale restores its primacy"
    rationale: "wordmark-as-display is the brand's most under-utilized asset"
```

### Refusal patterns

- Scale-displacement applied for emphasis-without-warrant (the
  captured site doesn't actually have a brand asset that warrants
  this treatment) fails Discipline 2: the move reads as
  "size-as-personality" — a C-cliff failure pattern per
  `direct/SKILL.md` § C-cliff failure mode.
- Scale-displacement on a page whose IA priority depends on
  multiple beats (conversion path with steps) conflicts with the
  IA preservation rule and refuses.

---

## How the bank composes

A page brief may declare **multiple moves** at `surprise: high`,
typically a document-shape paired with substrate-promotion (the
zine pattern is the canonical pair). At `surprise: medium`,
exactly one move from the bank is applied. At `surprise: low`, no
moves from the bank are applied (variant A / A1 / A2 / A3 all
operate on this tier).

The pairing rules:

- **document-shape + substrate-promotion** — natural pair; the
  document-shape's structural rhythm IS the substrate sequence.
- **inversion + scale-displacement** — natural pair; both
  amplify "single statement" register.
- **typographic-substitution + substrate-promotion** — works
  when the substrate IS the typographic register (a ledger page
  on cream substrate).
- **typographic-substitution + document-shape** — works when
  the document IS typographic (an index card; a railway timetable).

Pairings that fight:

- **inversion + document-shape** — inversion wants emptiness;
  document-shape wants per-block structure. Pick one.
- **scale-displacement + document-shape** — same conflict;
  document-shape's per-block rhythm fights one-element-at-8×.
