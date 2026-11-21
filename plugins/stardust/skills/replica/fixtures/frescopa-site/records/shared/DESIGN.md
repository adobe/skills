<!-- stardust:provenance
  writtenBy:        stardust:extract
  writtenAt:        2026-11-21T19:10:00Z
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/_computed-styles.json
    - stardust/current/pages/*.json (6 pages)
    - stardust/current/assets/css/shared/tokens.css
    - stardust/current/assets/css/atelier.css
    - stardust/current/assets/css/_ds/fr-scopa-design-system-40681532-d1a7-4dcb-94af-093bb0d56f27/tokens/*.css
  synthesizedInputs: []
  stardustVersion:  0.46.0
  mode:             descriptive (current state). Colour values are the site's normative oklch() tokens; hex in the body is an sRGB conversion.
-->
---
name: Fréscopa Atelier
description: Every morning, perfected.
colors:
  burgundy: "oklch(0.34 0.093 25)"
  burgundy-deep: "oklch(0.275 0.082 26)"
  terracotta: "oklch(0.605 0.116 44)"
  terracotta-deep: "oklch(0.515 0.108 40)"
  amber: "oklch(0.79 0.128 74)"
  amber-soft: "oklch(0.865 0.083 80)"
  teal: "oklch(0.55 0.05 205)"
  paper: "oklch(0.970 0.010 82)"
  paper-2: "oklch(0.948 0.015 78)"
  paper-3: "oklch(0.918 0.020 74)"
  sand: "oklch(0.884 0.025 71)"
  line: "oklch(0.855 0.018 68)"
  ink: "oklch(0.262 0.021 52)"
  ink-soft: "oklch(0.430 0.022 52)"
  charcoal: "oklch(0.222 0.016 52)"
  charcoal-2: "oklch(0.282 0.020 50)"
  line-dark: "oklch(0.400 0.020 55)"
  cream: "oklch(0.945 0.016 80)"
  cream-soft: "oklch(0.795 0.021 78)"
typography:
  display:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(3.4rem, 1.1rem + 8.4vw, 8rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
  h1:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.9rem, 1.7rem + 4.6vw, 5.4rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.1rem, 1.45rem + 2.6vw, 3.5rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  h3:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  h4:
    fontFamily: "Schibsted Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.25rem, 1.08rem + 0.7vw, 1.6rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: "normal"
  body-lg:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.125rem, 0.98rem + 0.5vw, 1.3125rem)"
    fontWeight: 400
    lineHeight: 1.62
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.2em"
  button:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    letterSpacing: "0.005em"
rounded:
  sm: "8px"
  md: "14px"
  lg: "22px"
  xl: "32px"
  pill: "999px"
spacing:
  3xs: "0.25rem"
  2xs: "0.5rem"
  xs: "0.75rem"
  sm: "1rem"
  md: "1.5rem"
  lg: "2.5rem"
  xl: "4rem"
  2xl: "6rem"
  section-y: "clamp(4.5rem, 3rem + 6vw, 9.5rem)"
  gutter: "clamp(1.25rem, 0.4rem + 3vw, 3rem)"
  content: "1120px"
  content-wide: "1320px"
  content-narrow: "760px"
components:
  button-primary:
    backgroundColor: "{colors.terracotta}"
    textColor: "{colors.cream}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0.95em 1.6em"
  button-primary-hover:
    backgroundColor: "{colors.terracotta-deep}"
  button-cream:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.burgundy}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0.95em 1.6em"
  button-ghost:
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0.95em 1.6em"
  filter-pill-active:
    backgroundColor: "{colors.burgundy}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    padding: "8px 17.6px"
  filter-pill:
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 17.6px"
  chip:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.burgundy}"
    rounded: "{rounded.pill}"
    padding: "0.55em 0.95em"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "1.3rem 1.4rem 1.4rem"
  input-dark:
    backgroundColor: "{colors.charcoal-2}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    padding: "0.85em 1.25em"
  header:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    height: "75px"
  footer:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.cream-soft}"
---

# Design System: Fréscopa Atelier

## Overview

**Creative North Star: "The Warm Counter at Seven"**

_Descriptive snapshot of the live site, not a target._ Fréscopa reads as a warm, crafted morning: paper-toned grounds (`--paper` oklch(0.97 0.01 82)), heavy burgundy grotesk headlines, terracotta pill buttons and large, softly lit food-and-appliance photography. Density is low — sections breathe on a fluid `--section-y` of clamp(4.5rem, 3rem + 6vw, 9.5rem) and copy sits in a 1120px content column with a fluid gutter.

Every colour is authored in oklch with warm hues (25–82°); there are no neutral greys, no pure white grounds and no pure black. Depth comes from warm-tinted, very soft two-layer shadows and from tonal steps between paper, paper-2 and paper-3; dark charcoal bands (CTA bands, footer) with amber radial glows punctuate the page. Motion is long and eased (quintic/expo curves, 0.35–0.9s), with small lifts on hover and a nudging arrow on CTAs.

Two build stacks render the same system: the home page (`shared/tokens.css` + `atelier.css`, BEM classes like `.hero`, `.btn--terracotta`) and five React design-system pages (`_ds/…/styles.css`, `fr-*` classes, inline styles under `#dc-root`). Computed values match across both.

**Key Characteristics:**
- Warm oklch palette: paper grounds, burgundy display type, terracotta action colour, amber accents on dark.
- Schibsted Grotesk 800/700 headlines with -0.02em tracking; Hanken Grotesk body, buttons and uppercase tracked labels.
- Pills everywhere for actions (999px); 22px cards; 32px feature images.
- Full-bleed photo heroes with a dark left-to-right scrim and copy anchored bottom-left.
- Charcoal closing CTA band + charcoal mega-footer on every page.

## Colors

A warm, low-chroma paper-and-ink system with one saturated action colour (terracotta) and a deep burgundy voice for headlines. Source: `_brand-extraction.json § palette`, tokens from `shared/tokens.css` / `_ds/…/tokens/colors.css`.

### Primary
- **Terracotta** (#ba6945 / oklch(0.605 0.116 44), `--terracotta`, also `--accent` and `--focus`): primary CTA fill (Order the Atelier, Meet your coffee agent, Get directions), eyebrows, inline links with animated underline, focus outline. 137 elements across all 6 pages.
- **Terracotta Deep** (#9a4f35 / oklch(0.515 0.108 40)): hover fill of terracotta buttons and hover text of links / ghost buttons.

### Secondary
- **Burgundy** (#5f201e / oklch(0.34 0.093 25)): every display headline, cream-button text, active filter pill fill, chip text. 139 elements, 6 pages. The logo's dark variant uses #58181d.
- **Burgundy Deep** (#481311 / oklch(0.275 0.082 26)): declared hover for `.btn--primary`; selection text.

### Tertiary
- **Amber** (#ebad54 / oklch(0.79 0.128 74)): eyebrows on dark/photo grounds (`.eyebrow--light`), footer column headings, radial glows on charcoal bands, focus border on the newsletter input.
- **Amber Soft** (#f0cd94): `::selection` background. **Teal** (#4d7a7f) is declared but not observed rendered.

### Neutral
- **Paper** (#f8f5ee / oklch(0.97 0.01 82), `--bg`): page and section background, cream button fill, card fill. Paints ~73% of measured background area.
- **Paper 2** (#f3ede3) and **Paper 3** (#ece2d6): alternating section grounds and chip fills (e.g. home `#learn`).
- **Sand** (#e4d6c7): declared tonal step.
- **Line** (#d8cdc3 / oklch(0.855 0.018 68)): 1px borders on cards, chips, inactive pills, header bottom hairline (219 border uses).
- **Ink** (#2d221b / oklch(0.262 0.021 52), `--fg`): nav links, ghost-button text, prices.
- **Ink Soft** (#5a4d45 / oklch(0.43 0.022 52)): the most frequent text colour — body paragraphs and ledes (227 elements).
- **Charcoal** (#211914) and **Charcoal 2** (#322721): footer and closing CTA bands; newsletter input fill.
- **Line Dark** (#51453e): borders on charcoal.
- **Cream** (#f3ece1) and **Cream Soft** (#c4bbad): button text on terracotta/burgundy, text on charcoal and over photographs.

### Named Rules
**The Warm Neutral Rule.** Every neutral carries a warm hue (50–82°); the site never uses #fff/#000 grounds or neutral greys — even shadows are tinted oklch(0.3 0.03 50 / …). The only literal white is the cream-button hover (`--_bg: #fff`).

## Typography

**Display Font:** Schibsted Grotesk (with system-ui, -apple-system, sans-serif)
**Body Font:** Hanken Grotesk (with system-ui, -apple-system, sans-serif)
**Label/Mono Font:** Hanken Grotesk via `--font-mono`, used uppercase and tracked (not monospaced)

**Character:** A heavy, slightly condensed news grotesk for headlines over a friendly humanist grotesk for reading; labels get wide tracking instead of a second family. `shared/tokens.css` still declares Playfair Display / DM Sans / DM Mono, but atelier.css and the _ds typography tokens override them — no page renders those families.

### Hierarchy
Computed at 1440 unless a token is quoted (`_computed-styles.json § aggregate.type.levels`, `_brand-extraction.json § type`).
- **Display** (800, `--fs-display` clamp(3.4rem, 1.1rem + 8.4vw, 8rem); 80px/80px on home hero; -0.02em): home hero "Every morning, perfected."; landing hero 70.4px, café hero 64px.
- **H1** (800, `--fs-h1`; 57.6px / 66.24px on beverages, machines, journal intros; -0.02em): page-intro headlines.
- **H2** (800, `--fs-h2`; 48px / 55.2px most common, 38.4–57.6px range; -0.02em): section headlines.
- **H3** (700, 19.2px / 21.5px most common; 24px on cards; 35.2px 800 for feature titles): card and item titles.
- **H4** (800, 25.6px / 29.44px): bundle titles on landing.
- **Body** (400, `--fs-body` 1.0625rem = 17px, line-height 1.62; ledes `--fs-body-lg` 18–21px): paragraphs in `--ink-soft`; ledes capped at ~44ch.
- **Label** (500, 0.75rem, 0.2em tracking, uppercase): eyebrows with a 1.6em rule before them; footer headings 11.52px/0.14em; card category tags 0.66rem/0.12em.
- **Button** (600, 0.9375rem = 15px, 0.005em): all pill buttons; filter pills 500 at 14.4px.

Scale audit: **ad-hoc** — level sizes 57.6 → 48 → 25.6 → 19.2px give ratios 1.2, 1.875, 1.333 (the _ds file comments "ratio ~1.28" for the fluid tokens). Headings are sentence case; 0% uppercase.

### Named Rules
**The Full-Stop Headline Rule.** Headlines are short declarative sentences that end in a full stop ("Three ways to fill a cup.", "Made in the workshop.").

## Layout

Single centred content column: `.container` max-width `--content` 1120px (`--content-wide` 1320px, `--content-narrow` 760px) with fluid `--gutter` clamp(1.25rem, 0.4rem + 3vw, 3rem). Cap-probe (home + café at 1440 → 2560) measured `containerMaxWidth` 1120px: every section caps its content at 1120px (one 620px module on home) while backgrounds stay full-bleed and the shell is fluid; recorded in DESIGN.json `extensions.breakpoints`. Sections stack full-bleed with vertical padding `--section-y` (72–89.6px measured at 1440 on home), alternating paper / paper-2 grounds; heroes are full-bleed photos (home 828px tall at 1440, landing 94vh, café min(78vh, 720px)). Grids: two-column split media/copy (gap clamp(2rem, 6vw, 5rem)), auto-fit card grids (minmax(258px, 1fr), gap clamp(1.2rem, 2.5vw, 1.8rem)). The header is fixed, 75px tall. Source layout breakpoints (max-width): 980px, 900px, 760px (hero art-direction / stacked layout, matches hero.js `MOBILE = 760`), 560px.

## Elevation & Depth

Hybrid: tonal layering (paper → paper-2 → paper-3, charcoal bands) carries most depth; three warm two-layer shadows add lift on interactive surfaces, mostly as a hover response.

### Shadow Vocabulary
- **sm** (`box-shadow: 0 1px 2px oklch(0.3 0.03 50 / 0.06), 0 2px 8px oklch(0.3 0.03 50 / 0.05)`): cream buttons at rest, mood toggles, header hairline stack.
- **md** (`box-shadow: 0 4px 14px oklch(0.3 0.03 50 / 0.07), 0 14px 34px oklch(0.3 0.03 50 / 0.08)`): button hover lift, sustain photo, product panels (52 uses — the most frequent).
- **lg** (`box-shadow: 0 14px 34px oklch(0.26 0.03 50 / 0.10), 0 34px 80px oklch(0.26 0.03 50 / 0.13)`): card hover, scrolled nav.

### Named Rules
**The Lift-On-Hover Rule.** Buttons rise 2px and cards 5px on hover with a shadow step up; nothing bounces (`--ease-quint` cubic-bezier(0.22, 1, 0.36, 1)).

## Shapes

Soft and rounded throughout. Radius tokens `--r-sm` 8px, `--r-md` 14px, `--r-lg` 22px, `--r-xl` 32px, `--r-pill` 999px. Cross-page counts at 1440: 999px ×284 (buttons, pills, chips, badges, inputs), 22px ×110 (cards, panels — the non-pill mode and the area mode), 50% ×88 (icon buttons, dots), 32px ×36 (feature photos, large panels), 14px ×16, 11px ×14, 8px ×2 (skip link). Borders are 1px hairlines in `--line` (paper) or `--line-dark` (charcoal). Photographs are cropped with `object-fit: cover` and rounded to the container.

## Components

### Buttons
- **Shape:** full pill (999px), 1px transparent border, 14.25px × 24px padding at 1440 (0.95em 1.6em), Hanken Grotesk 600 15px; primary CTAs carry a trailing → that slides 3px on hover.
- **Primary (terracotta):** terracotta fill, cream text; hover → terracotta-deep fill, `--shadow-md`, translateY(-2px).
- **Cream:** paper fill, burgundy text, `--shadow-sm`; hover → #fff fill, `--shadow-md`. Used on charcoal/photo grounds ("Find a café→", footer "Sign up").
- **Ghost:** transparent, currentColor text, border currentColor at 32% (34–42% on dark/media); hover → 8% tint of terracotta-deep, border 55%, text terracotta-deep (12% cream tint on dark).
- **Declared, not observed:** `.btn--primary` burgundy fill.

### Chips
- **Style:** `.chips li` — paper-2 fill, burgundy text, 1px line border, pill, Hanken 0.74rem uppercase 0.06em tracking.
- **Filter pills:** active = burgundy fill + cream text + burgundy border; inactive = transparent, ink text, line border; Hanken 500 14.4px, 8px × 17.6px padding (café region pills 14.08px, 7.2px × 16px). Hover: text and border to terracotta.
- **Mood toggles:** 11.84px Hanken 400 pills (active burgundy, inactive paper with ink-soft text).

### Cards / Containers
- **Corner Style:** 22px (`--r-lg`).
- **Background:** paper with 1px line border; category tag as a blurred paper pill top-left.
- **Shadow Strategy:** none at rest; `--shadow-lg` + translateY(-5px) on hover, image scales to 1.06.
- **Internal Padding:** 1.3rem 1.4rem 1.4rem; footer row with price (Schibsted 700 1.25rem) above a line divider.

### Inputs / Fields
- **Style:** newsletter input on charcoal — charcoal-2 fill, 1px line-dark border, pill, 0.85em × 1.25em, cream text.
- **Focus:** border turns amber, no outline. Global `:focus-visible` elsewhere: 2px solid terracotta outline, 3px offset.

### Navigation
- **Header:** fixed 75px bar; light logo (32px tall) + five text links (The Atelier, Machines, Beverages, Café, Journal) in Hanken 500 ink, + Search / Account / Cart icon buttons and a two-bar menu toggle. Transparent over photo heroes, paper at 90% opacity elsewhere; on scroll swaps to the dark burgundy logo and gains a shadow. Active page link marked `.is-active` on the design-system pages. Footer nav links cream-soft → cream on hover.

### Eyebrow (signature)
Uppercase tracked label (0.75rem, 500, 0.2em) in terracotta (amber on dark) preceded by a 1.6em × 1px rule at 50% opacity; sits above almost every section headline.

### Closing CTA band (signature)
Charcoal band with amber radial glow, cream headline, short supporting line and a primary + ghost (or cream + ghost) pill pair; closes home, landing, beverages and café.

## Do's and Don'ts

### Do:
- **Do** keep every neutral warm and in oklch: paper oklch(0.97 0.01 82), ink oklch(0.262 0.021 52), line oklch(0.855 0.018 68).
- **Do** set headlines in Schibsted Grotesk 800 burgundy with -0.02em tracking, sentence case, ending in a full stop.
- **Do** use 999px pills for every action and 22px for cards.
- **Do** precede section headlines with the eyebrow label.
- **Do** close pages with the charcoal CTA band and charcoal footer.

### Don't:
- **Don't** use pure #000 / #fff grounds or neutral grey shadows; shadows are warm-tinted (oklch(0.3 0.03 50 / …)).
- **Don't** render Playfair Display / DM Sans / DM Mono — they are declared in shared/tokens.css but overridden everywhere.
- **Don't** add bounce or overshoot to motion; the site uses `--ease-quint` / `--ease-expo` only.
