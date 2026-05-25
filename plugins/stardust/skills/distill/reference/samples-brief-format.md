# SAMPLES.md format

The narrative vocabulary brief produced by `stardust:distill` Phase 5.
`stardust:direct` reads this as the resolved Mode B anchor set when the
user phrase references samples. Format below; worked example in this
project's `samples/SAMPLES.md` (redesign-adobecom).

## Provenance header

First content of the file: an HTML comment carrying:

```html
<!--
_provenance:
  writtenBy: stardust:distill
  writtenAt: <ISO-8601>
  readArtifacts:
    - samples/static/<slug>/<entry-html>
    - samples/live/snapshots/<slug>.html
    - samples/live/snapshots/<slug>.png
    ...
  samples:
    - <slug-1>  (kind, role, one-line descriptor)
    - <slug-2>  ...
  stardustRole: anchor reference set for /stardust:direct (Phase 2 Mode B inputs)
-->
```

## Opening paragraph (mandatory)

One paragraph that:

- Names the shared design language (e.g., "all share the same `--s2a-`
  token system + Adobe Clean type stack + Lenis-driven scroll").
- Names each sample's register (e.g., "bizpro-hub is business-pro,
  plan-page is conversion-pricing, sr-homepage is consumer-creative").
- Names the consumer (always `stardust:direct` Phase 2 Mode B inputs).

This paragraph is what direct quotes back at the user when it surfaces
Mode B activation ("Anchor set from `samples/SAMPLES.md`: <paragraph>").

## § 1 Type system

Table of the shared scale. Columns:

| Token | Value | Use |
|---|---|---|
| `<canonical-token-name>` | size, line-height, tracking | Surface where used |

Follow the table with:

- **Families** — block listing each font family with its weights and
  ship status (local file vs CDN vs web font service). Note license
  flags if visible.
- **Fluid heading sizes** — `clamp(<min>, <vw>vw, <max>)` formulas for
  every heading that has a fluid scale. If samples don't use clamp,
  state "all sizes static; consider fluid clamp() per intent-dimensions
  § type-scale".
- **Display rules** — short block of typographic conventions the
  samples observe (case, line-height range, max-width on body, eyebrow
  placement). Direct lifts these as hard constraints in DESIGN.json's
  `typography.rules[]`.

## § 2 Color

Palette as a swatched markdown table:

| Token | Value | Role |
|---|---|---|
| `--<token-name>` | `#hex` or `oklch(...)` | role-name |

Then:

- **Reservations** — list of `color → reservedFor[]` pairs (e.g.,
  Adobe red reserved for brand-mnemonic). Direct propagates these
  to `DESIGN.json.extensions.colorReservations[]`.
- **Rules** — short block of color conventions (where pure black
  and pure white are legal, which surfaces are dark-on-light vs
  inverted, whether gradients are decorative or functional).
- **Brand-faithful inversion candidates** — list any value in the
  palette that contradicts impeccable's hard rules (pure `#000`,
  pure `#fff`, hex-not-OKLCH, glassmorphism). Each entry is a
  candidate inversion that direct's `brand_faithful_inversions[]`
  block will pick up under Mode A (per `direct/reference/direction-format.md`
  § Brand-faithful inversions).

## § 3 Spacing + grid + density

Three short sub-sections:

- **Spacing scale** — table of `{ token, value }` from base to 6xl
  (or whatever the samples use).
- **Section padding** — primary vs secondary vs footer. Identify the
  density tier (compact / balanced / packed) per
  `stardust/reference/intent-dimensions.md` § 4.
- **Grid** — cols (mobile + desktop), outer padding, gutter, max
  content width.

## § 4 Motion

This is the section direct reads to populate `DESIGN.json.extensions.motion`
and the `STACK.md` overlay (if the project uses overlay files).

- **Libraries** — bullet list of every JS library loaded by ≥1
  sample, with pinned version where readable: `Lenis 1.x`, `GSAP 3.12`,
  `ScrollTrigger 3.12`, `Locomotive 5`, etc.
- **CSS-only motion patterns** — list every CSS technique observed:
  `animation-timeline: view(block)`, `scroll-snap-type`, `@keyframes`
  + entry triggers, etc.
- **Named choreographies** — for each captured choreography (one per
  bullet), one-paragraph brief: name, mechanism (CSS / rAF / library),
  sample of origin, target surface. Worked examples from this
  project: hero-scroll-grow (300vh + sticky), stories-mouse-pan,
  tutorial-reverse-hero, studio-banner garage-door, footer-wordmark-wipe.

## § 5 Component patterns

For each repeated DOM pattern the samples carry (card grid, banner,
navigation anatomy, hero composition, footer columns, accordion):

- **Pattern name** — short kebab-case (`subscription-card-on-bay`).
- **Captured from** — sample(s) where it appears.
- **Shape brief** — 3-5 sentences describing the structure, the slots,
  the typography hierarchy, and what makes the pattern recognizable.
  Include enough HTML to convey the captured shape (3-15 lines of
  markup is usually enough).
- **Variants observed** — per-sample variations of the pattern.

Direct reads these as the `componentStyle[]` block in DESIGN.json
and the per-component overlay briefs in `stardust/direction/` (if
the project uses overlay files).

## § 6 Voice per register

One sub-section per sample (not aggregated). For each:

- **Hero headline** — verbatim copy.
- **First body paragraph** — verbatim.
- **3 representative CTAs** — verbatim labels.
- **3 navigation labels** — verbatim.
- **Footer line** — verbatim.

Direct uses per-sample voice to match register in B/C/... variants.
The aggregation step is intentional — voice is the most register-
specific trait; averaging would erase signal.

## § 7 Assets

- **Fonts** — list of font files (with formats, weights, license
  visibility).
- **Photography vs illustration ratio** — approx percentages.
- **Signature motifs** — recurring visual elements (gradient
  treatments, photography crop style, illustration style).

## § 8 Divergent traits

The list direct reads to pick which trait to **amplify** in the B/C/...
variants. Each entry:

- **Trait name** — kebab-case (`scroll-driven choreography`).
- **Strongest sample** — which sample carries it most.
- **Amplification candidate for variant** — `B` / `C` / `D+`.
- **Risk** — short note on what amplifying this trait might break
  (e.g., motion fatigue, layout-shift propagation, attention saturation).

Direct picks variant amplifications by reading this section. If
divergent traits are empty (samples are too similar), direct surfaces
this and the user is asked whether to seed a non-sample trait via the
divergence toolkit.
