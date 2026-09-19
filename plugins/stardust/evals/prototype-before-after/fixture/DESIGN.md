<!-- stardust:provenance
  writtenBy: stardust:direct
  writtenAt: 2026-07-21T10:31:48Z
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/DESIGN.md
    - stardust/current/DESIGN.json
    - stardust/direction.md
  synthesizedInputs: []
  stardustVersion: 0.10.0
  note: TARGET visual system for the redesign, authored from the resolved
        direction. The descriptive snapshot of the live site stays in
        stardust/current/DESIGN.md.
-->
---
name: Ledgerline
description: Audit-grade bookkeeping that reads like a well-designed notebook, not a filing cabinet
colors:
  ledger: "#27187e"
  carbon-copy: "#758bfd"
  tracing-paper: "#aeb8fe"
  graph-paper: "#f1f2f6"
  highlighter: "#ff8600"
  typewriter: "#1a1740"
  index-card: "#f9f9fd"
  ruled-line: "#d3d7ee"
typography:
  display:
    fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(2.75rem, 6vw, 4.5rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  body-sm:
    fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  figure:
    fontFamily: "'Martian Mono', 'SFMono-Regular', Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.06em"
  quote:
    fontFamily: "'Roboto Slab', Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
  2xl: "96px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.ledger}"
    textColor: "{colors.graph-paper}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
  button-primary-hover:
    backgroundColor: "{colors.typewriter}"
  button-accent:
    backgroundColor: "{colors.highlighter}"
    textColor: "{colors.typewriter}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
  button-secondary:
    backgroundColor: "{colors.index-card}"
    textColor: "{colors.ledger}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
  card:
    backgroundColor: "{colors.index-card}"
    rounded: "{rounded.md}"
    padding: "32px"
  figure-chip:
    backgroundColor: "{colors.tracing-paper}"
    textColor: "{colors.ledger}"
    typography: "{typography.figure}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
---

# Design System: Ledgerline

## Overview

**Creative North Star: "The Annotated Notebook"**

The redesign keeps Ledgerline's audit-grade seriousness and swaps the
filing-cabinet wrapper for a notebook a first-time founder would
actually open: a cool graph-paper ground, one deep indigo voice that
descends from the old navy, a single highlighter-orange stroke per
viewport, and figures set in monospace so the numbers — the product —
read as ledger columns. Layout is asymmetric where the old site was
uniform; every page still ends on the same closing band so the
conversion path is never in doubt.

**Key Characteristics:**
- Tinted-neutral ground with one indigo voice and one orange highlight
- Grotesk display and body, monospace for every figure, slab serif for
  the one quotation per page
- Pill buttons and 12px cards on an otherwise flat, hairline-ruled page
- Offset, notebook-margin compositions instead of centred stacks

## Colors

One indigo carries authority; orange is a highlighter, not a second
brand color; everything else is a tint of the ground.

### Primary
- **Ledger** (#27187e): Headline accents, primary buttons, the closing
  band, link text. The only saturated color allowed to fill a large
  surface.

### Secondary
- **Carbon Copy** (#758bfd): Hover and focus states, secondary link
  text, chart strokes. Never a fill behind body copy.
- **Tracing Paper** (#aeb8fe): Figure chips, section tints, table
  stripes.

### Tertiary
- **Highlighter** (#ff8600): One stroke per viewport — a marker
  underline, a "Most popular" flag, the accent button. Never body text.

### Neutral
- **Graph Paper** (#f1f2f6): Page ground.
- **Index Card** (#f9f9fd): Cards, inputs, the header bar.
- **Ruled Line** (#d3d7ee): Hairlines, borders, dividers.
- **Typewriter** (#1a1740): All body text and headings.

### Named Rules
**The Highlighter Rule.** Highlighter appears at most once per viewport
and never on more than one element type per page. If two things need
emphasis, one of them uses Ledger instead.

## Typography

**Display Font:** Space Grotesk (Helvetica Neue / Arial fallback)
**Body Font:** Space Grotesk
**Figure Font:** Martian Mono (system monospace fallback)
**Quote Font:** Roboto Slab (Georgia fallback)

**Character:** A geometric grotesk doing both display and body work
keeps the page calm; expression comes from scale and from the monospace
figures, which put every price, count and date in a ledger column.

### Hierarchy
- **Display** (700, clamp(2.75rem, 6vw, 4.5rem), 1.0): Page H1, one per page.
- **Headline** (700, 2.5rem, 1.1): Section H2s.
- **Title** (600, 1.75rem, 1.2): Card, tier and FAQ headings.
- **Body** (400, 1.125rem, 1.55): Paragraphs, lists, answers.
- **Body Small** (400, 0.9375rem, 1.5): Footer links, captions, legal.
- **Figure** (500, 0.875rem, 1.4, 0.06em): Eyebrows, prices, counts.
- **Quote** (400, 1.5rem, 1.35): The one pull-quote per page.

Scale is a perfect fourth (1.333) from body to display.

### Named Rules
**The Column Rule.** Any number that means money, a count or a date is
set in Figure, tabular, on its own line or chip. Numbers never sit
inline in a grotesk sentence when they are the point of the sentence.

## Layout

Container 1200px (stepped up one notch from the captured 1140px).
Twelve columns, 24px gutter. Compositions favour a notebook margin:
headline and eyebrow in the left four columns, supporting content
offset right, so pages read as annotated rather than centred. Section
padding runs 80–112px on desktop (default 96px), 64px on tablet, 48px
on mobile. Cards collapse to a single column below 768px; the header
collapses to a burger below 900px.

## Elevation & Depth

Flat by default. Depth comes from the Graph Paper / Index Card
alternation and Ruled Line hairlines. One shadow exists:
`0 12px 32px rgba(39, 24, 126, 0.10)` (Ledger at 10%), used on the
highlighted pricing tier and on the mobile navigation sheet only.

### Named Rules
**The One Lift Rule.** At most one element per page carries the shadow.

## Shapes

Pills (999px) for every button and chip; 12px radius on cards, inputs
and media; 6px on figure chips. No other radii. Marker underlines under
display words are 0.18em thick, Highlighter, offset below the baseline.

## Components

### Buttons
- **Shape:** Pill, 14px 28px padding, weight 600.
- **Primary:** Ledger fill, Graph Paper text. Hover → Typewriter fill.
- **Accent:** Highlighter fill, Typewriter text. One per page, reserved
  for the tier or action the direction wants a first-time founder to take.
- **Secondary:** Index Card fill, Ledger text, 1px Ruled Line border.
- **Focus:** 3px Carbon Copy ring, 2px offset.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Index Card on Graph Paper.
- **Shadow Strategy:** None, except the single lifted pricing tier.
- **Border:** 1px Ruled Line.
- **Internal Padding:** 32px (24px below 768px).

### Inputs / Fields
- **Style:** Index Card ground, 1px Ruled Line, 12px radius, label above
  in Figure.
- **Focus:** 3px Carbon Copy ring.

### Navigation
- Index Card bar, Ruled Line bottom hairline, not sticky. Wordmark left,
  four text links, one primary pill right. Below 900px the links move
  into a sheet toggled by a burger button.

### Figure Chip (signature component)
- Tracing Paper ground, Ledger text, Figure type, 6px radius. Wraps
  every number that carries meaning: prices, counts, the "Most popular"
  flag (that one in Highlighter, per the Highlighter Rule).

## Do's and Don'ts

### Do:
- **Do** set every meaningful number in Figure (monospace) — numbers are the product.
- **Do** keep one Highlighter stroke per viewport and let Ledger carry everything else.
- **Do** offset compositions to the notebook margin; centred stacks are the old site.
- **Do** keep the closing band on every page — the conversion path is inherited, not redesigned.

### Don't:
- **Don't** use Highlighter for text or for more than one element type per page.
- **Don't** add gradients, grain overlays or drop shadows on type.
- **Don't** make the header sticky or add a ticker/marquee.
- **Don't** invent statistics, logos or quotes; content comes from `stardust/current/pages/*.json` verbatim.
