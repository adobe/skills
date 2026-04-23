---
chassis: magazine
version: "0.1"
---

# Magazine

Editorial-spread presentation. Masthead with volume / issue / date line, multi-column body text, pull quotes, drop caps, sidebar rail for metadata. Sections follow magazine structure rather than brand-document structure.

## Intent

Feels like a brand profile printed in a quarterly. Appropriate when the seed's register is `tabloid`, `memoir`, `auction catalogue`, `travel agency brochure`, `liturgical program`, `museum didactic`, or `supermarket flyer` — registers that traditionally live in magazine and newspaper form. Also appropriate for brands whose voice is expansive and narrative rather than operational or archival.

Reference artifact in this repo: `tmp/e2e-3/aem-design/brand-board-v2-avanguardia.html` (Nonna's Arsenal "Avanguardia 1977" variant).

## Navigation

Masthead-integrated nav. The top of the page is the magazine's physical masthead: brand name set very large, volume/issue/date line beneath it in mono, a thin hairline rule, then a single-line nav of section labels styled as magazine sectionheads ("CONTENTS · FEATURE · ESSAY · LETTER · PALETTE · BACK MATTER").

No sticky nav — the reader scrolls, and section returns are via Contents at the top or footer.

## Section order

Editorial rhythm:

1. Masthead (brand name · Vol · Issue · date)
2. Contents (explicit TOC)
3. Feature (the brand philosophy / masthead hero, rendered as a magazine feature with pull quote and drop cap)
4. Letter From (persona-as-editor, signed)
5. Palette (rendered as a magazine color-study spread with named chips and brief captions)
6. Typography (specimen spread)
7. Voice (rendered as a two-column editorial with do/don't as sidebars)
8. Motifs (rendered as a visual essay — each motif gets a dedicated magazine panel with caption)
9. Components (product catalogue spread)
10. Photography (photo essay with caption rail)
11. Personas (portrait page)
12. Logo (mark on final page, centered, caption below)
13. Colophon / Back matter (typography details, stock, printer — metadata that belongs at a magazine's end)

## Hero shape

Three-part masthead:
- Kicker line above the main headline (mono, small, all caps: `FEATURE · VOL III, ISSUE 04 · APRIL 2026`)
- Oversized headline with italic accent words (display serif or slab)
- Lede paragraph below, set as a long single paragraph with a drop cap on the first letter

A magazine spread does not have a CTA in the hero. Actions live further down or in the colophon.

## Eyebrow / label conventions

Section labels styled as magazine department heads: `FEATURE`, `ESSAY`, `LETTER`, `CONTENTS`, `COLOPHON`. Each label is set in a slab or compressed serif, uppercase, often in a brand accent color. Numbering optional — `I. FEATURE` is acceptable, numerals in roman or arabic as the brand prefers.

## Spacing rhythm

Magazine grid: typically 12 columns, with body text in 2 or 3 columns. Pull quotes breach the columns (take 2 columns width and sit among 3). Margins wide at left and right; gutter between columns narrow. Vertical spacing tight within a section, generous between sections.

## Typography register

Display + italic serif + drop caps lead. Body text is the editorial serif or a humanist sans. Monospace is rare — reserved for the colophon and any technical spec. Italic is load-bearing and appears in pull quotes, accent words, and letter-from signatures.

## Motif placement

Each motif is a magazine panel with its own page layout: a heading, a visual panel demonstrating the motif, body copy describing it and its usage, a caption row. Motifs are NOT a grid of fixed-size cards — they're a visual essay, one motif per "page" of the brand's magazine.

## What this chassis is NOT

- Not a classic archive — no numbered `§ 01 ·` eyebrows; magazine uses `FEATURE` / `ESSAY`
- Not a dashboard — no cards, no meters, no status chips
- Not a pinboard — no rotation, no overlap (editorial magazines are rigorous grids, not scrapbooks)
- Not a SaaS landing page — no hero-CTA, no feature grid

## Example reference

*Apartamento*. *The Gentlewoman*. *MacGuffin* (structurally — MacGuffin's chassis is magazine even though its subject is archival). A Condé Nast-era *Vanity Fair* letter from the editor. Pirelli calendar editorial afterword.
