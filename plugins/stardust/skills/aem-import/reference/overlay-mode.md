# Overlay mode

Alternative mode of `stardust:aem-import`. The page is authored as a
template HTML file at `templates/<theme>.html` containing the
prototype's `<main>` with `[data-slot]` markers on every authorable
element. The DA content carries block tables whose cells fill the
slots by name. The overlay engine (already present in the EDS project
via the engine patch) fetches the template, walks `[data-slot]`
markers, and substitutes cell values.

## When it wins

- **Pixel parity.** ~100%. The template HTML is the prototype's HTML
  almost verbatim — only authorable string values are slot-bound.
- **Pitch / brand-critical pages.** When the win condition is
  "every wrap exactly matches the design Comp," overlay delivers.
- **Single-page-per-archetype scenarios.** When you have one
  high-stakes landing page (or just a handful), the template-per-page
  cost is acceptable.

## When it loses

- **Authorability.** Authors can change slot VALUES but not slot
  STRUCTURE. If they want to add a new section or rearrange the
  composition, the template has to change (code change).
- **Many pages with the same shape.** Same template, same slots, just
  different content — the overlay HTML duplicates structure. Blocks
  mode reuses theme CSS instead.

## Template authoring spec

Lift the prototype's `<main>` content into `templates/<theme>.html`
with `[data-slot]` markers added on every authorable element. The
slot names should follow a hierarchical convention:

- Section-level slot: `data-slot="background"` for hero bg images
- Field-level slot: `data-slot="eyebrow"`, `data-slot="headline"`,
  `data-slot="cta"`, etc.
- Nested cards/tiles: `data-slot="card-N.title"`, `data-slot="card-N.body"`,
  etc. (dot notation)

Example (the wheelercat-home template):

```html
<main>
  <section class="hero" data-slot="background"
    style='background-image: linear-gradient(...), url("/assets/wheelercat-home/media/Compact_Track_Loader.webp")'>
    <div class="container hero__inner">
      <span class="label hero__eyebrow" data-slot="eyebrow">Wheeler · Services Commitment</span>
      <h1 class="display hero__headline">
        <span class="hero__headline-line hero__headline-line--accent" data-slot="headline-accent">REDEFINING</span>
        <span class="hero__headline-line" data-slot="headline-main">COMMITMENT</span>
      </h1>
      <p class="hero__supporting">
        <span class="hero__sup-accent">PARTNER WITH WHEELER</span> FOR YOUR EQUIPMENT MAINTENANCE...
      </p>
      <div class="hero__actions">
        <a class="btn btn-pill-light" href="/services-commitment/" data-slot="cta">Learn More About Our Services Commitment</a>
      </div>
    </div>
  </section>

  <section class="finance">
    <div class="container">
      <div class="finance__head">
        <span class="label" data-slot="eyebrow">Finance</span>
        <h2 class="headline" data-slot="title">CURRENT FINANCE OFFERS</h2>
      </div>
      <div class="finance__grid">
        <article class="finance-card">
          <span class="label finance-card__eyebrow">Finance</span>
          <h3 class="title finance-card__title" data-slot="card-1.title">0% FOR UP TO 60 MONTHS + $500 TOWARD CVA</h3>
          <p class="body-copy finance-card__body" data-slot="card-1.body">On select Cat compact machines. Cat Vehicle Agreement bonus included.</p>
          <a class="btn btn-primary finance-card__cta" href="/specials/" data-slot="card-1.cta">Learn More</a>
        </article>
        <!-- card-2, card-3 same pattern -->
      </div>
    </div>
  </section>

  <!-- more sections with [data-slot] markers... -->
</main>
```

## DA content shape

The DA content carries block tables shaped to match the template's
section + slot structure. Each `<section>` in the template has a
corresponding `<div class="<section-class>">` block in DA. Each row
in the block table has `<slot-name>` in cell 1 and the slot value
in cell 2.

```html
<body>
<header></header>
<main>
<div>
  <div class="hero">
    <div><div><p>eyebrow</p></div><div><p>Wheeler · Services Commitment</p></div></div>
    <div><div><p>headline-accent</p></div><div><p>REDEFINING</p></div></div>
    <div><div><p>headline-main</p></div><div><p>COMMITMENT</p></div></div>
    <div><div><p>cta</p></div><div><p><a href="/services-commitment/">Learn More About Our Services Commitment</a></p></div></div>
    <div><div><p>background</p></div><div><picture><img src="..."></picture></div></div>
  </div>
  <div class="finance">
    <div><div><p>eyebrow</p></div><div><p>Finance</p></div></div>
    <div><div><p>title</p></div><div><p>CURRENT FINANCE OFFERS</p></div></div>
    <div><div><p>card-1.title</p></div><div><p>0% FOR UP TO 60 MONTHS + $500 TOWARD CVA</p></div></div>
    <!-- etc. -->
  </div>
  <div class="metadata">
    <div><div>template</div><div>wheelercat-home</div></div>
    <div><div>title</div><div>Wheeler Cat - ...</div></div>
    <div><div>description</div><div>...</div></div>
  </div>
</div>
</main>
<footer></footer>
</body>
```

## Engine behavior

`applyTemplateOverlay()`:
1. Reads `template` metadata → `wheelercat-home`
2. Loads `/styles/wheelercat-home.css`
3. Fetches `/templates/wheelercat-home.html` → succeeds (overlay mode)
4. Parses template, finds all `[data-slot]` elements
5. For each section, matches `<section class="X">` to DA block
   `<div class="X">`, reads slot values from cells
6. Walks `[data-slot]` markers in template section, substitutes
   cell values via `writeSlot()` (element-typed: IMG, PICTURE, A,
   default innerHTML)
7. Replaces `main.innerHTML` with populated template
8. Sets `main.dataset.overlay = "wheelercat-home"` (skips standard
   `loadSections` for this main)
9. Sets `main.dataset.theme = "wheelercat-home"` (chrome resolution)

If author leaves a slot empty in DA, the template's DEFAULT value (the
text/element authored inline in the template) stays. This is how the
wheelercat-home test page can render the full prototype content with
only the metadata block authored in DA.

## Hybrid pattern

A project can run overlay-mode and blocks-mode pages side by side:

- `index.html` (home) → `template: wheelercat-home` → overlay
- `/customer-value-agreements-blocks-test` → `template: wheelercat-cva-blocks` → blocks
- `/service-blocks-test` → `template: wheelercat-cva-blocks` → blocks

Each page picks its mode via the template name's existence on disk:
- `templates/wheelercat-home.html` exists → overlay mode fires
- `templates/wheelercat-cva-blocks.html` doesn't exist → blocks mode fires

Both share `fragments/<theme>/header.html` + `footer.html` (chrome
resolves from `dataset.theme` in both modes).

## When to choose which

| Page type | Recommended mode |
|---|---|
| Home / hero pitch artifact | overlay |
| Landing page with brand-critical visuals | overlay |
| Long-tail content pages (about, service detail, blog index) | blocks |
| Pages with frequently-edited content | blocks |
| Pages authors restructure themselves | blocks |
| Single-page-per-archetype with fixed structure | either; blocks if authors edit content |

The trade-off is real and project-specific. The skill should not
default opinions about it — it lets `--mode` choose per page.
