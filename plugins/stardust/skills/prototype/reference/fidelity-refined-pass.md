# Fidelity refined pass

Concrete CSS recipes for the `--fidelity=refined` craft micro-pass.
Triggered by `prototype` Discipline 8 (per `SKILL.md` § Craft-time
disciplines).

`quick` is the default sketch fidelity. `refined` adds the
checklist below before the file is written. `production` adds the
WCAG AA audit + harden pass on top of `refined`.

Each item is **mandatory** when `--fidelity=refined`. The pass
runs after craft returns its initial output and before validation;
the rendered file is updated in place.

---

## 1. Formal type scale as CSS custom properties

Replace improvised pixel sizes with a named scale exposed at
`:root`. Stops the cascade where one heading is `28px`, the next
section's heading is `30px`, and the third is `32px` for no reason.

```css
:root {
  --t-10: 10px;
  --t-11: 11px;
  --t-12: 12px;
  --t-13: 13px;
  --t-14: 14px;
  --t-15: 15px;
  --t-17: 17px;
  --t-19: 19px;
  --t-22: 22px;
  --t-26: 26px;
  --t-32: 32px;
  --t-44: 44px;
}
```

Use `clamp()` for Display / Headline sizes that scale with
viewport:

```css
:root {
  --t-display: clamp(3.5rem, 8vw, 6rem);
  --t-headline: clamp(2.5rem, 5vw, 4rem);
  --t-title: var(--t-22);
  --t-body: var(--t-15);
  --t-label: var(--t-13);
}
```

Any inline `font-size: <px>` declaration on a rendered element
that doesn't reference a custom property fails the check.

## 2. Tabular numerals on inline digits

```css
.stat-number,
.price,
.date,
.time,
[data-tabular] {
  font-variant-numeric: tabular-nums;
}
```

Apply automatically to any element whose content is `^[\d\s.,$:%-]+$`
(numeric-only) or which carries `[data-tabular]`. Catches stat-row
numbers, price columns, hours rows, address ZIPs — anywhere the
digit grid needs to align across rows.

## 3. Text wrapping + hanging punctuation

```css
html {
  hanging-punctuation: first;
}

h1, h2, h3, .headline, .display {
  text-wrap: balance;
}

p, .body, [data-prose] {
  text-wrap: pretty;
}
```

`balance` keeps headlines from orphan-trailing a single word;
`pretty` makes prose paragraphs avoid ladders and rivers without
a manual line-break. `hanging-punctuation: first` lets opening
quote marks hang into the margin so the first letter of the
paragraph aligns flush.

## 4. Sliding left-rule on nav hover

Replace the default `background-color` flash with a 4px sliding
left-rule:

```css
.nav-link {
  position: relative;
  padding-left: 12px;
  transition: padding-left 240ms cubic-bezier(0.25, 1, 0.5, 1);
}
.nav-link::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: currentColor;
  transform: scaleY(0);
  transform-origin: top;
  transition: transform 240ms cubic-bezier(0.25, 1, 0.5, 1);
}
.nav-link:hover::before,
.nav-link:focus-visible::before {
  transform: scaleY(1);
}
```

Easing: `ease-out-quart` (the cubic-bezier above). 240ms feels
deliberate without dragging.

## 5. Hairline hover on list items

Replace the default `background-color: var(--ds-surface-hover)`
flash with a 0% → 100% width hairline under list items:

```css
.list-item {
  position: relative;
}
.list-item::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: 0;
  height: 1px;
  width: 0;
  background: currentColor;
  transition: width 320ms cubic-bezier(0.25, 1, 0.5, 1);
}
.list-item:hover::after,
.list-item:focus-within::after {
  width: 100%;
}
```

## 6. Section-head triplet (kicker + title + more-link)

Replace the loose `<h2> + <a>` pattern with a three-part triplet
that baseline-aligns the more-link to the title's baseline:

```html
<header class="section-head">
  <p class="kicker">Catalog · 6 anchors</p>
  <h2 class="title">The Beer.</h2>
  <a class="more-link" href="/beers">All beers →</a>
</header>
```

```css
.section-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: baseline;
  gap: 0 24px;
  margin-bottom: 32px;
}
.kicker {
  grid-column: 1 / -1;
  font: var(--t-13)/1 var(--ds-mono);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ds-muted);
  margin: 0 0 8px 0;
}
.title {
  grid-column: 1;
  font: var(--t-headline)/1.05 var(--ds-display);
  margin: 0;
}
.more-link {
  grid-column: 2;
  align-self: baseline;
  font: var(--t-15)/1 var(--ds-body);
  text-decoration: none;
  border-bottom: 1px solid currentColor;
}
```

## 7. Italic display couplet (no structurally-vague `<b>`)

Replace `<b>` sub-tags inside headlines with semantic italic
emphasis. The `<b>` element is structurally vague (it carries
weight without meaning); an italic display couplet is the
typographic way to mark emphasis inside a Display headline.

```html
<!-- avoid -->
<h1 class="display">The Beer. <b>Six anchors.</b></h1>

<!-- prefer -->
<h1 class="display">The Beer. <em class="display-em">Six anchors.</em></h1>
```

```css
.display-em {
  font-style: italic;
  font-weight: inherit;
  font-family: var(--ds-display-italic, var(--ds-display));
  color: var(--ds-accent);
}
```

## 8. Typographic plate for sidebar bottom

Rework the bottom of a sidebar (or footer column) as a typographic
plate: italic address + small-caps utility + dotted footnote.

```html
<div class="plate">
  <address class="plate-address">
    Wasatch Back Beerworks, Heber Valley · Park City
  </address>
  <p class="plate-utility">EST. 1996 · Brewed in Utah</p>
  <p class="plate-footnote">
    All trademarks held by their respective owners.
  </p>
</div>
```

```css
.plate {
  border-top: 1px solid currentColor;
  padding-top: 20px;
  display: grid;
  gap: 6px;
}
.plate-address {
  font: italic var(--t-15)/1.4 var(--ds-body);
  font-style: italic;
}
.plate-utility {
  font: var(--t-12)/1 var(--ds-body);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.plate-footnote {
  font: var(--t-11)/1.4 var(--ds-body);
  color: var(--ds-muted);
  border-top: 1px dotted currentColor;
  padding-top: 8px;
}
```

---

## Validator

After craft writes the refined output, the pass validator runs
before file write:

1. `:root` declares at least 6 type-scale custom properties from
   the recipe in § 1.
2. Every element matching `^[\d\s.,$:%-]+$` in textContent has
   `font-variant-numeric: tabular-nums` in its computed style.
3. `html { hanging-punctuation: first; }` is declared.
4. Heading elements declare `text-wrap: balance`; prose elements
   declare `text-wrap: pretty`.
5. Nav hover does not animate `background-color`; it animates a
   `::before` pseudo's `transform` or `opacity`.
6. The page contains zero `<b>` elements (use `<em>` or a
   `display-em` class instead).
7. Sidebars / footer columns that include an `<address>` AND a
   utility line render them inside a `.plate` container with the
   recipe in § 8.

Findings here are P2 advisories on `refined`; they become P1
blocks on `production`.

---

## Why `refined` is not the default

`quick` is the default because most prototype runs are sketches
the user reviews and iterates on. Locking the scale, italic
couplets, and typographic plate at first render makes early
iteration harder — the user wants to see the structural decision
in a free-er state before the craft micro-pass tightens it.

When the user phrases the request as *"a pre-launch quality
pass"*, *"production-leaning"*, or *"the migrate-time render"*,
the agent defaults to `refined`.
