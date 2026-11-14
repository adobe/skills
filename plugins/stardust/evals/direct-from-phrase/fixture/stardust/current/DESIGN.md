<!-- stardust:provenance
  writtenBy: stardust:extract
  writtenAt: 2026-07-21T09:47:05Z
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/pages/home.json
  synthesizedInputs: []
  stardustVersion: 0.10.0
  note: DESCRIPTIVE snapshot of the existing visual system, captured from
        computed styles. Not a target spec.
-->
---
name: Ledgerline (current state)
description: Captured visual system of the live ledgerline.com marketing site
colors:
  ledger-navy: "#1f3a5f"
  chart-blue: "#3d6b9e"
  slate-ink: "#2b2f36"
  paper-white: "#ffffff"
  ledger-mist: "#f4f6f8"
  rule-grey: "#dde3e9"
typography:
  display:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "2px"
  md: "4px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  section: "64px"
components:
  button-primary:
    backgroundColor: "{colors.ledger-navy}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "12px 28px"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ledger-navy}"
    rounded: "{rounded.md}"
    padding: "12px 28px"
  card:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "24px"
---

# Design System: Ledgerline (current state)

## 1. Overview

**Creative North Star: "The Filing Cabinet"**

The captured system reads like well-kept paperwork: white pages, navy
letterhead, serif headings, thin grey rules. Color is rationed —
navy carries authority in the hero, the header CTA, and the CTA band;
everything between is white or a pale mist grey. Density is moderate
and rhythm is uniform: every page repeats the same 64px section
cadence with no compositional surprises.

**Key Characteristics:**
- Conservative two-hue palette (navy + muted blue) on white
- Serif display (Georgia) over utilitarian body (Arial)
- Flat surfaces, hairline borders, one whisper-quiet card shadow
- Identical page anatomy across all five captured pages

## 2. Colors

A restrained institutional palette: one navy voice, everything else neutral.

### Primary
- **Ledger Navy** (#1f3a5f): Hero band, CTA band, primary buttons, wordmark. The only color that ever fills a surface.

### Secondary
- **Chart Blue** (#3d6b9e): Text links, tier prices, focus rings. Never used as a fill.

### Neutral
- **Slate Ink** (#2b2f36): All body text and interior headings.
- **Paper White** (#ffffff): Default page ground.
- **Ledger Mist** (#f4f6f8): Alternating section ground, cards on white, footer.
- **Rule Grey** (#dde3e9): Card borders, input borders, table rules.

### Named Rules
**The Letterhead Rule.** Navy fills exactly three surfaces per page —
hero or page head accents, the header CTA, and the pre-footer CTA
band. It never appears mid-page.

## 3. Typography

**Display Font:** Georgia (with Times New Roman fallback)
**Body Font:** Arial (with Helvetica fallback)

**Character:** A dated but coherent trust pairing — bookish serif
headlines over a default-stack utility body. No webfonts are loaded;
the site relies entirely on system-installed families.

### Hierarchy
- **Display** (700, 2.5rem, 1.2): Page H1s, one per page.
- **Headline** (700, 2rem, 1.25): Section H2s.
- **Title** (400/700, 1.5rem, 1.3): Card and tier headings.
- **Body** (400, 1rem, 1.6): All paragraphs, lists, and table copy.

Scale is a clean major-third (1.25) — modular, per the scale audit.

## 4. Elevation

Effectively flat. One shadow exists in the whole system
(`box-shadow: 0 1px 3px rgba(20,30,45,0.08)`) on cards and pricing
tiers; depth is otherwise conveyed by 1px Rule Grey borders and the
white/mist ground alternation.

## 5. Components

### Buttons
- **Shape:** Barely rounded (4px).
- **Primary:** Ledger Navy fill, white text, 12px 28px padding, weight 700.
- **Secondary:** White fill, navy text, 1px navy border.
- **Hover / Focus:** Primary darkens ~8%; no motion, no transforms.

### Cards / Containers
- **Corner Style:** 4px.
- **Background:** Paper White on mist sections, Ledger Mist on white sections.
- **Shadow Strategy:** The single ambient card shadow; otherwise borders.
- **Border:** 1px Rule Grey.
- **Internal Padding:** 24px.

### Inputs / Fields
- **Style:** 1px Rule Grey stroke, white ground, 2px radius, visible labels above.
- **Focus:** 2px Chart Blue ring at 30% alpha.

### Navigation
- White header bar, Arial 400 links in Slate Ink, navy "Request a
  demo" button pinned right. No mega-menu, no mobile drawer captured
  beyond a simple collapse.

## 6. Do's and Don'ts

### Do:
- **Do** keep navy (#1f3a5f) as the only surface-filling color; it appears at hero, header CTA, and CTA band only.
- **Do** hold the 64px section rhythm and white/mist alternation on every page.
- **Do** keep serif display over sans body — it is the system's one deliberate pairing.

### Don't:
- **Don't** introduce gradients — the captured system has zero.
- **Don't** use uppercase headings; only 4% of captured headings are uppercase (eyebrow labels).
- **Don't** add motion; the captured site has no transitions beyond default link hover color.
