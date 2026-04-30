# Template and module rendering

How `migrate` renders a page when the page is not itself approved
but its type has an approved sibling (Path A′), or when a page
matches no template and must be rendered as a one-off (Path B —
`unique` rendering).

This is the substantive new behavior introduced by the migrate-
template-canon refactor. Path A (page is itself `approved`) is
unchanged — the proposed.html is used verbatim, with `:root`
refreshed from latest DESIGN.md.

## Render path selection

For each page in scope, the render branch is chosen by LLM
judgment:

| Branch     | Trigger                                                                          |
|------------|----------------------------------------------------------------------------------|
| **Path A** | Page status is `approved`. Use its proposed.html verbatim.                       |
| **Path A′**| Page status is `directed`, page `type` matches an approved sibling's archetype.  |
| **Path B** | Page typed `unique`, or no template archetype matches.                           |

The LLM should prefer Path A′ when a template is genuinely
applicable. Path B is the escape hatch — for landing pages with no
peer template, error pages, search pages, or pages whose content
shape doesn't fit any approved archetype.

## Path A′ — template-applied rendering

For a `directed` page whose `type` has an approved archetype:

### Step 1 — load the archetype

Read the approved sibling's `<slug>-proposed.html` from
`stardust/prototypes/`. This is the **structural seed** for the
target page.

### Step 2 — inject this page's content into slots

Read the target page's typed slots from
`stardust/current/pages/<slug>.json § slots`. The slots were
captured during `extract --prep`.

For each slot in the archetype (identified by `data-slot="..."`
within `data-template="<type>"`), inject this page's value:

- `data-slot="article-headline"` ← target page's `headline` slot
- `data-slot="article-byline"`   ← target page's `byline` slot
- `data-slot="article-body"`     ← target page's `body` slot
- ... and so on for every slot the archetype defines

The injection preserves the archetype's structural elements
(wrapping divs, classes, data-attributes) and replaces the inner
content with the target page's slot value.

### Step 3 — adapt where content doesn't fit

The target page may carry content that doesn't have a matching
slot in the archetype, or may be missing slots the archetype
requires. The LLM judges:

- **Extra content** (target has a video embed; archetype has no
  video slot) → place in the archetype's overflow region (a slot
  named `<template>-overflow` if defined, else after the body
  slot). Log a `template-adapted` decision in
  `migrationDecisions[]`.
- **Missing content** (target has no byline; archetype has a
  byline slot marked `required`) → if the slot has a default,
  use it. Otherwise fail validation; surface to user.
- **Bespoke content** (target has a state qualifier the archetype
  doesn't anticipate) → render as a bespoke slot marked
  `data-bespoke`; log a `module-bespoke-slot` decision.

The LLM has full discretion on adaptation. Each adaptation is
logged so the user can audit.

### Step 4 — module rendering inside the page

For each module instance in the archetype (marked
`data-module="<id>"`), render via the module's canonical
rendering at `stardust/canon/modules/<id>.html`. Inject the
target page's module-instance values from
`current/pages/<slug>.json` (modules carry per-instance slot
values just like templates).

If the target page has a module instance the archetype doesn't
position (e.g., target has a `donate-band` after the body that
the archetype's article template doesn't include), insert the
module at a sensible position; log as `template-adapted`.

### Step 5 — canon application

Inject canon chrome into the page's structural skeleton:

- Replace the archetype's `<header data-canon>` with the contents
  of `stardust/canon/header.html`.
- Replace `<footer data-canon>` with the contents of
  `stardust/canon/footer.html`.
- Inject `stardust/canon/canon.css` into the page's `<style>`
  block alongside the `:root` token contract block.

Canon is applied verbatim — no rewriting, no template-specific
adjustments. Deviations from canon (e.g., article template wants
a sticky reading-progress bar in addition to the canon header)
are applied **on top of** canon, not as replacements; the
deviation is marked with `data-deviation="<reason>"` and logged.

## Path B — unique rendering

For a page typed `unique` or one whose type has no approved
archetype, render as a one-off:

### Step 1 — load the inputs

The page's primary guidance is the visual canon. Available
inputs:

- DESIGN.md tokens (colors, type, spacing, radii)
- `DESIGN.json.extensions.canon.pinned` — concrete chosen values
- `DESIGN.json.extensions.canon.compositionalMoves` — guidance text
- `DESIGN.json.extensions.modules[]` — module catalog
- `stardust/canon/header.html`, `footer.html`, `canon.css`

### Step 2 — compose the page

The LLM composes the page by:

1. **Chrome.** Apply canon header and footer verbatim (same as
   Path A′ Step 5).
2. **Body.** Read the page's content from
   `current/pages/<slug>.json`. Compose a body structure that
   carries the page's content sensibly:
   - Use existing modules from the catalog where the content
     shape matches (e.g., a unique page with a 211-style
     hotline panel renders the panel as a `hotline-211` module
     instance).
   - Compose other sections from primitives — `<section>` with
     `data-section`, `data-purpose`, `data-layout` attributes;
     visual styling derived from DESIGN.md tokens and canon
     CSS classes.
   - Honor compositional moves as **soft guidance**, not strict
     rules.
3. **Mark as unique render.** Log a `unique-render` decision in
   `migrationDecisions[]` with a brief reason naming why the
   page is rendered uniquely (no matching template, page typed
   `unique`, etc.).

### Step 3 — validate

Same validation contracts as Path A′ (see § Validation contracts
below).

### Don't invent modules from Path B

A unique page should not invent modules. If a section's content
shape suggests a new module-like lockup, the LLM composes it as
a one-off, not promotes it implicitly. Module promotion is the
responsibility of `extract --prep` and `direct --prep`.

## Validation contracts

Strict contracts (refuse-on-fail) regardless of render branch:

| Contract                                                                       | A | A′ | B |
|--------------------------------------------------------------------------------|---|----|---|
| `:root` token block at top of first `<style>`                                  | ✓ | ✓  | ✓ |
| `data-template` on `<body>` or `<main>` matching page type                     | ✓ | ✓  | ✓ |
| `data-section` on every `<section>`                                            | ✓ | ✓  | ✓ |
| Provenance block as first child of `<head>`                                    | ✓ | ✓  | ✓ |
| Required slots filled per template/module catalog                              | n/a | ✓ | n/a |
| Color reservations not violated (`DESIGN.json.extensions.colorReservations[]`) | ✓ | ✓  | ✓ |
| Impeccable hard rules (with brand-faithful inversions lifted)                  | ✓ | ✓  | ✓ |
| Sidecar `<slug-path>/_meta.json` written                                       | ✓ | ✓  | ✓ |

Soft contracts (log + surface, don't refuse):

- **Template-conformance shape** — Path A′ deviations are
  expected and logged; not enforced byte-for-byte.
- **Bespoke slots** — logged; counted toward auto-promotion at
  3 instances.
- **Canon deviations** — logged with reason.
- **Broken internal links** — every link rewritten to the
  migrated tree; missing-slug targets flagged
  `data-broken-link="true"` and surfaced in run summary.
- **Content overflow** — extra content placed in overflow
  region with a logged `template-adapted` decision.

### Brand-faithful inversion handling

`DESIGN.json.extensions.divergence.brand_faithful_inversions[]`
declares which impeccable hard rules are deliberately inverted by
the direction (e.g., pure `#FFFFFF` retained, `#000000` retained,
hex format retained, 0px corners retained, ALL CAPS retained).

Validation reads this list and **lifts the corresponding hard
rules** from the strict contracts. Without this lift, every
brand-faithful Mode A migration would fail validation on hex
colors and pure white/black usage. The inversions are the
explicit user-confirmed escape hatch.

## Deviation policy

Three kinds of deviation can occur during rendering. Each gets a
distinct treatment.

### Canon deviation (Path A′ and B)

The page's chrome or compound CSS has been deliberately changed
relative to canon. Allowed by default; logged.

```html
<header data-canon data-deviation="sticky reading-progress bar for long-form">
  <!-- canon header HTML, plus the deviation -->
</header>
```

```json
"migrationDecisions": [
  {
    "kind": "canon-deviation",
    "where": "header",
    "what": "Added sticky reading-progress bar",
    "reason": "Article template needs reading-progress for long-form content"
  }
]
```

### Template adaptation (Path A′ only)

The archetype's structure has been adjusted to fit the target
page's content. Allowed by default; logged.

```json
"migrationDecisions": [
  {
    "kind": "template-adapted",
    "template": "article",
    "adaptations": [
      { "what": "extra video embed", "where": "after article-body slot", "via": "overflow region" }
    ],
    "reason": "Content carries a video module not present in canonical article template"
  }
]
```

### Bespoke slot (any path)

An instance of a module or template carries a slot not declared
in the catalog. Allowed by default; logged. Auto-promotion at 3
instances of the same bespoke slot name.

```html
<aside data-module="hotline-211">
  <span data-slot="state" data-bespoke>Utah</span>
  <!-- ... -->
</aside>
```

```json
"migrationDecisions": [
  {
    "kind": "module-bespoke-slot",
    "module": "hotline-211",
    "slot": "state",
    "value": "Utah",
    "reason": "Home instance carries a state qualifier; not present on /get-help instance"
  }
]
```

## Run summary surfacing

Migrate's end-of-run summary surfaces non-trivial decisions:

```
migrate complete
================

 22 migrated         home, about, pricing, ...
  3 unchanged        blog, news/post-3 (idempotent skip)
  0 failed
  0 stale skipped

Pages with non-trivial decisions: 8
  about        canon-deviation: footer carries financials disclaimer
  donate       template-adapted: amount-pills slot moved above headline
  ...

Broken internal links: 3
  /events       referenced by 2 pages; not in inventory
  /press        referenced by 1 page; not in inventory
  /board        referenced by 1 page; not in inventory

Bespoke slots crossing promotion threshold: 1
  hotline-211: "state"  (3 instances) — consider promoting via $stardust prepare-migration --refine-module
```

The summary is intentionally compact; full traces live in each
page's `_meta.json` sidecar.

## References

- `skills/migrate/SKILL.md` — top-level migrate procedure
- `skills/migrate/reference/migration-procedure.md` — per-page
  procedure including idempotent skip and output-path mapping
- `skills/migrate/reference/metadata-and-jsonld.md` — head
  composition (orthogonal concern)
- `skills/migrate/reference/content-preservation.md` — content
  rules (preserve, transform, drop)
- `skills/prototype/reference/canon-extraction.md` — how canon
  is built (input to this rendering procedure)
- `skills/stardust/reference/data-attributes.md` — vocabulary
  including `data-template`, `data-module`, `data-slot`,
  `data-canon`, `data-deviation`, `data-bespoke`,
  `data-broken-link`
