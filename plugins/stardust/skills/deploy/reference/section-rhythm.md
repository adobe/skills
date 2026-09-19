# Section rhythm — majority in CSS, deviations as classifiers, remainder as tokens (full text)

Companion to deploy Step 3 (`foundation.md` § 3). Read:
- § Decision rule — when inter-module spacing on a template varies per band and the first instinct is a spacing token per section;
- § Section-per-module encoding — when the source's modules each carry their own margins;
- § Engine — before writing any `main .section` margin rule;
- § Traps — when the engine renders scattered 8/56 px deltas with no error;
- § Token remainder — for the deviations CSS cannot derive;
- § Hand-off from replica / § What never ships — at the replica → deploy boundary.

## Decision rule

Measure the template's *majority* inter-module spacing per breakpoint (a few tokens cover most of a site's inter-module gaps; a component-based source ships a canon `--sp-*` set) and write it ONCE in `main .section` / `.<block>-container` CSS. Express every *derivable* deviation — module kind, adjacency, first/last in a group, hero-after-nav — as a `.section` classifier. Carry only the *non-derivable* remainder as named section styles inside the vocabulary budget (§ 3), under the three token rules below. "The importer knows the spacing, the stylesheet should not infer it" is right for the remainder and wrong for the majority.

## Section-per-module encoding

When module kinds carry distinct margins in the source, the converter emits one `main > div` per source module (a lone heading, a lone CTA, a lone image, a text run); containers are flattened, never nested. Nothing is written about the kind — CSS classifies it: `title` = a section whose only child is a heading, `button` = a lone `p.button-container`, `image` = a lone `picture` or `p > picture`, else `text`. Section-per-module pages carry no section metadata at all, so the density and style lints stay quiet.

## Engine — one property, one consumer

```css
/* the ONLY place a section's margin-top is set */
main .section { --mt: var(--sp-module-to-module); margin-top: var(--mt); }
/* classifiers at .section specificity: .section stays OUTSIDE :where() */
main .section:where(:has(> .default-content-wrapper > :is(h1, h2, h3, h4, h5, h6):only-child)) + .section { --mt: var(--sp-title-to-module); }
main .section:where(:has(> .default-content-wrapper > p.button-container:only-child)) { --mt: var(--sp-text-to-button); }
main .section:where(.hero-container) + .section { --mt: var(--sp-after-hero); }
```
Band interiors (a tinted section wrapping several modules) convert `--mt` into `padding-top` on their first wrapper and keep the section margin at the band's own value. Every classifier computes at `.section` specificity, so a named section style (`.dark`, `.narrow`) still wins by source order. The `--sp-*` tokens live in `:root` per breakpoint (§ 3 tokens).

## Traps — all silent: nothing errors, the page shows scattered pixel deltas

- `:where()` zeroes the WHOLE compound it wraps: `main :where(.section:has(…))` is (0,0,1) and loses to `main .section`; write `main .section:where(:has(…))`.
- A `:has()` nested inside `:has()` (an `a:has(> picture)` inside the pattern) is invalid in Chromium and drops the entire rule. Rewrite as `:is(:has(A), :has(B))` / `:not(:has(A)):not(:has(B))`.
- Classifier and marker names never contain `-container` (the runtime's block-container class shape collides with the block test).
- Image classifiers accept both `p > picture` and a bare `picture`; a `\xa0`-only paragraph is a line box, not an empty one.
- Multi-wrapper surfaces contain child margins with `display: flow-root` (§ 3); empty styled sections respect section-status hiding (#121).
- No lint validates selectors today; until one does, run `CSS.supports('selector(<rule>)')` over every stylesheet rule in the harness page and fix any `false` before tuning pixels.

## Token remainder — the three rules from the token regime

1. *First/last-child attribution.* A source module's top margin belongs to the section AFTER a boundary, its bottom margin to the section BEFORE it; when a breakpoint drops a column, re-attach the orphaned margin to the surviving neighbour.
2. *Page-level contract marker.* Remainder tokens act only under a `body.<marker>` class the template sets (`decorateTemplateAndTheme` from the `template` metadata row), so an unconverted page never inherits half a rhythm.
3. *Per-breakpoint table.* Each token has one column per breakpoint; at 360 the top tokens collapse to one value. Several tokens on one section are comma-separated (D7: `style: tinted, pt-lg` → `.tinted.pt-lg`), never space-separated (#120).

## Hand-off from replica

Replica records inter-module margins per module kind per breakpoint in `capture/tokens.json` — `spacing.module[<kind>][<bp>] = { mt, afterText }` — next to the canon `--sp-*` tokens; deploy lifts them into `:root` verbatim and the engine consumes them. Where `progress.json.modules[<kind>]` exists, an optional `rhythm` field on the kind entry records what was lifted. There is no separate rhythm state file.

## What never ships

Encoder-derived adjacency (`after-boundary`, `first-in-group`, `eight-columns`) as `style` values — if the encoder can compute it, CSS can (`+` on classified sections), and the density/style lints fire when it leaks; per-band pixel tokens (`pb-sm`, `separator-60`); rhythm deltas as accepted residuals — they route to CSS and the gate bars stay where they are.
