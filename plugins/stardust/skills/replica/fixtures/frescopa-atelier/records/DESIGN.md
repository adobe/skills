---
_provenance:
  writtenBy: stardust:replica
  writtenAt: 2026-11-21T07:08:24Z
  mode: bounded-single
  synthesizedFrom:
    - stardust/current/pages/frescopa-atelier-index-html.json
    - stardust/replica/lifted-tokens.json
---

# Design — Fréscopa Atelier (captured, preserve mode)

Descriptive spec of the live page https://markszulc.github.io/frescopa-atelier/index.html. Every value traces to
`stardust/replica/lifted-tokens.json` (the source's own tokens.css / atelier.css). Sidecar: `DESIGN.json`.

## Colour
Warm neutrals on cream paper (#f8f2e8, raised #f1e8d8), ink #2f271f body text, burgundy #5b1c22 headlines,
terracotta #b7613e accents and primary buttons, amber #eaa33a detail, charcoal #241d17 dark close and footer,
cream #f1e9db text on dark. Source values are OKLCH; the hex values are the author's stated approximations.

## Typography
Display: Schibsted Grotesk 800, line-height 1.15, tracking -0.02em, burgundy. Body: Hanken Grotesk 400,
1.0625rem / 1.62. Eyebrows: Hanken Grotesk 0.75rem uppercase, tracking 0.2em. Fluid scale: h1
clamp(2.9rem, 1.7rem + 4.6vw, 5.4rem), h2 clamp(2.1rem, 1.45rem + 2.6vw, 3.5rem). Both faces are
self-hosted from Google Fonts (OFL).

## Layout
Content cap 1120px (module caps on 8 of 9 sections, one 620px), fluid shell, gutter
clamp(1.25rem, 0.4rem + 3vw, 3rem). Section padding clamp(3rem, 2rem + 4vw, 6rem). Fixed transparent
header that turns into blurred paper on scroll.

## Shape and depth
Radii 8 / 14 / 22 / 32 / pill. Soft warm shadows (sm / md / lg in DESIGN.json).

## Page structure
Hero (photo, h1 "Every morning, perfected."), intro, taste radar, calendar, favourites cards,
sustainability, testimonials, café band, closing CTA on dark, footer.
